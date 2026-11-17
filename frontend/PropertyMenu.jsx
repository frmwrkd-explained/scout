// PropertyMenu — changing a collection's properties from where they are looked at.
//
// A property could be ADDED from a record's Details panel and nowhere else, and could not be
// renamed, re-typed or removed at all. A person looking at a table thinks "this column should be
// called Role" or "I need a column for the city" while looking at the column — so that is where
// the controls are: on the column's own header in the table, and beside each name in the view
// bar's Properties menu (which is how the list, the cards and the board reach them).
//
// ONE editor, two doors. `PropertyEditor` is the form; the table header and the Properties menu
// both mount it, so a property is edited the same way wherever it was reached from. `AddProperty`
// is `AddField` (the composer the record page already had) in its popover clothes, plus the one
// thing a view needs afterwards: the new property is switched on in the view it was added from.
//
// What a change means is decided in `backend/collections.mjs` (`updateField`, `removeField`) and
// said here in a sentence where it matters:
//   · the name is a label — the key in the files never changes;
//   · a type change keeps every stored value as it is;
//   · removing a property takes it out of the collection, and leaves the values in the files.
//
// `Menu` and `MenuRow` live here too: the anchored popover and its rows, used by the view bar's
// controls and by the table header. They were private to ViewBar.jsx until a second file needed
// them.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Btn, Input } from './ui';
import { FieldIcon } from './cells';
import AddField, { KINDS, TypePicker } from './AddField';
import { pickableFields, fieldLabel } from './viewDisplay';
import { updateField, removeField, fieldTypes } from './schemaApi';
import './properties.css';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// ── the popover ──────────────────────────────────────────────────────────────────────────────
// Anchored under its trigger: render it inside a `position: relative` wrapper that also holds the
// button. A click anywhere in that wrapper is NOT "outside" — otherwise the trigger's mousedown
// closes the menu and its click opens it again, and the button can never close what it opened.
export function Menu({ open, onDismiss, width = 200, align = 'left', children }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = e => {
      const box = ref.current;
      if (!box) return;
      const anchor = box.parentElement || box;
      if (!anchor.contains(e.target)) onDismiss();
    };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); onDismiss(); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, onDismiss]);
  if (!open) return null;
  return (
    <div ref={ref}
      style={{
        ...sx('position:absolute;top:100%;z-index:40;margin-top:6px;padding:6px;border-radius:10px;display:flex;flex-direction:column;gap:1px;max-height:70vh;overflow:auto;text-align:left;cursor:default'),
        [align]: 0, width,
        background: 'var(--surface-2)', border: '1px solid var(--border-3)', boxShadow: '0 12px 28px rgba(0,0,0,.4)',
      }}>
      {children}
    </div>
  );
}

export function MenuRow({ on, onClick, icon, label, hint, danger, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={disabled ? '' : 'hBg'}
      style={{
        ...sx('display:flex;align-items:center;gap:10px;min-height:32px;padding:5px 9px;border-radius:6px;text-align:left;background:none;border:none;width:100%;transition:background 130ms ease'),
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1,
        color: danger ? 'var(--danger)' : on ? 'var(--fg)' : 'var(--fg-muted)',
      }}>
      {icon ? <FieldIcon type={icon} size={14} /> : null}
      <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
        <span style={{ ...sx('font-size:var(--t-small);font-weight:' + (on ? 600 : 500)) }}>{label}</span>
        {hint ? <span style={{ ...sx('font-size:var(--t-data);line-height:1.35'), color: 'var(--fg-faint)' }}>{hint}</span> : null}
      </span>
      {on ? <span style={{ ...mono('font-size:var(--t-data)'), color: 'var(--fg-soft)' }}>✓</span> : null}
    </button>
  );
}

export function MenuDivider() {
  return <div role="separator" className="pmDivider" />;
}

// The keys a view currently shows, in order — what "hide" removes from and "add" appends to.
// Resolved through viewDisplay so a view that has never named its fields (and so shows the
// default six) is written back as exactly what was on screen, minus or plus one.
export const shownKeys = (collection, view) => pickableFields(collection, view).shown.map(f => f.key);

const CHOICE_TYPES = ['select', 'status', 'multiselect'];
const kindOf = type => KINDS.find(k => k.type === type) || { type, label: type, hint: '' };

// A choice is a bare string, or an object carrying a colour and (for a stage) a group. The editor
// changes the VALUE and keeps whatever else the choice had.
const toRows = options => (options || []).map(o => (typeof o === 'string' ? { value: o } : { ...o }));
const fromRows = rows => rows.filter(r => String(r.value || '').trim()).map(r => {
  const value = String(r.value).trim();
  const { value: _v, ...rest } = r;
  return Object.keys(rest).length ? { value, ...rest } : value;
});
// The same list, in the shape `fromRows` writes — so "did the choices change" compares like with
// like and a stage whose options are objects does not read as edited the moment it is opened.
const normalised = options => JSON.stringify(fromRows(toRows(options)));

function Toggle({ on, onChange, label, hint }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="pmToggle hBg" onClick={() => onChange(!on)}>
      <span className={'pmSwitch' + (on ? ' on' : '')} aria-hidden="true"><span /></span>
      <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
        <span className="pmToggleLabel">{label}</span>
        {hint ? <span className="pmNote">{hint}</span> : null}
      </span>
    </button>
  );
}

// ── the choices of a select / stage / tags property ──────────────────────────────────────────
function Choices({ rows, onChange, open }) {
  const set = (i, value) => onChange(rows.map((r, n) => (n === i ? { ...r, value } : r)));
  const move = (i, by) => {
    const to = i + by;
    if (to < 0 || to >= rows.length) return;
    const next = [...rows]; const [row] = next.splice(i, 1); next.splice(to, 0, row);
    onChange(next);
  };
  return (
    <div className="pmChoices">
      {rows.map((r, i) => (
        <div key={i} className="pmChoice">
          <Input value={r.value || ''} placeholder="Choice" onChange={e => set(i, e.target.value)} aria-label={'Choice ' + (i + 1)}
            style={sx('flex:1;min-width:0;height:28px;padding:0 9px;font-size:var(--t-small)')} />
          <button type="button" className="pmIcon" title="Move up" aria-label="Move this choice up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="pmIcon" title="Move down" aria-label="Move this choice down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="pmIcon" title="Remove this choice" aria-label="Remove this choice" onClick={() => onChange(rows.filter((_, n) => n !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="pmAdd hFgL" onClick={() => onChange([...rows, { value: '' }])}>+ Add a choice</button>
      <span className="pmNote">
        {open && !rows.length ? 'No list: any tag someone types is allowed. ' : ''}
        Renaming or removing a choice does not change records that already use it.
      </span>
    </div>
  );
}

// ── the editor ───────────────────────────────────────────────────────────────────────────────
// Props
//   collection · field         what is being edited
//   view · onSaveView          the view it was reached from — "Hide in this view" writes it
//   onSchemaChanged()          called after the schema changed (App re-reads collections + view)
//   onClose()                  leave the editor (the caller decides whether that closes a popover
//                              or returns to a list)
//   actor                      who is making the change
//   startAt                    'edit' (default) | 'delete' — the header's "Delete property…" opens
//                              the same editor already asking
//   onBack                     present ⇒ a ‹ back control in the header (the Properties menu)
export function PropertyEditor({ collection, field, view, onSaveView, onSchemaChanged, onClose, actor, startAt = 'edit', onBack }) {
  const fixed = !!field.primary || !!field.gate;   // the title and the gate: a new name, nothing else
  const shown = fieldLabel(field);
  const [label, setLabel] = React.useState(shown);
  const [type, setType] = React.useState(field.type);
  const [picking, setPicking] = React.useState(false);
  const [rows, setRows] = React.useState(() => toRows(field.options));
  const [multiline, setMultiline] = React.useState(!!field.multiline);
  const [lead, setLead] = React.useState(!!field.primary_media);
  const [confirming, setConfirming] = React.useState(startAt === 'delete');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [changes, setChanges] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    fieldTypes().then(r => { if (alive) setChanges(r.changes || {}); }).catch(() => { if (alive) setChanges({}); });
    return () => { alive = false; };
  }, []);

  const canBecome = fixed || !changes ? [] : (changes[field.type] || []);
  const kinds = [field.type, ...canBecome].map(kindOf);
  const hasChoices = CHOICE_TYPES.includes(type);
  const canHide = !field.primary && !!onSaveView && shownKeys(collection, view).includes(field.key);
  const canDelete = !fixed;

  // Only what actually changed goes to the server, so a rename is a rename in the log.
  const patch = () => {
    const out = {};
    const name = label.trim();
    if (name !== shown) out.label = name || null;
    if (type !== field.type) out.type = type;
    if (hasChoices) {
      const next = fromRows(rows);
      if (JSON.stringify(next) !== normalised(field.options) || type !== field.type) out.options = next.length || type !== 'multiselect' ? next : null;
    }
    if (type === 'text' && multiline !== !!field.multiline) out.multiline = multiline || null;
    if (type === 'file' && lead !== !!field.primary_media) out.primary_media = lead || null;
    return out;
  };
  const dirty = Object.keys(patch()).length > 0;

  const run = async work => {
    setBusy(true); setError(null);
    try { await work(); }
    catch (e) { setError(e.message || String(e)); setBusy(false); return; }
    setBusy(false);
    onClose && onClose();
  };

  const save = () => {
    const change = patch();
    if (!Object.keys(change).length) return onClose && onClose();
    if (hasChoices && type !== 'multiselect' && !(change.options || field.options || []).length) return setError('Add at least one choice.');
    return run(async () => {
      await updateField(collection.id, field.key, change, actor);
      if (onSchemaChanged) await onSchemaChanged();
    });
  };
  const hide = () => run(async () => {
    await onSaveView({ ...view, fields: shownKeys(collection, view).filter(k => k !== field.key), card: null });
  });
  const remove = () => run(async () => {
    await removeField(collection.id, field.key, actor);
    if (onSchemaChanged) await onSchemaChanged();
  });

  const onKeyDown = e => {
    if (e.key !== 'Enter' || picking || confirming) return;
    if (e.target && e.target.tagName === 'INPUT') { e.preventDefault(); save(); }
  };

  const chosen = kindOf(type);

  return (
    <div className="pmForm" onKeyDown={onKeyDown}>
      <div className="pmHead">
        {onBack ? <button type="button" className="pmIcon" onClick={onBack} title="Back to the list" aria-label="Back to the list">‹</button> : null}
        <span className="pmTitle">{confirming ? 'Delete property' : 'Edit property'}</span>
        <span className="pmKey" style={{ fontFamily: MONO }} title="The key this property is saved under in every file. It never changes.">{field.key}</span>
      </div>

      {confirming ? (
        <div className="pmConfirm">
          <span className="pmConfirmName">{shown}</span>
          <span className="pmConfirmText">Removes it from the collection. Values already saved in the files are kept.</span>
          <div className="pmActions">
            <Btn variant="danger" size="sm" style={sx('font-size:var(--t-data)')} onClick={remove} busy={busy}>{busy ? 'Deleting…' : 'Delete property'}</Btn>
            <Btn variant="ghost" size="sm" style={sx('font-size:var(--t-data)')} onClick={() => (startAt === 'delete' ? onClose && onClose() : setConfirming(false))}>Keep it</Btn>
          </div>
        </div>
      ) : (
        <>
          <label className="pmField">
            <span className="pmLabel">Name</span>
            <Input value={label} autoFocus onChange={e => setLabel(e.target.value)} placeholder={field.key}
              style={sx('height:30px;padding:0 10px;font-size:var(--t-small)')} />
          </label>

          <div className="pmField">
            <span className="pmLabel">Type</span>
            <button type="button" data-type-button className="pmTypeBtn hBd" aria-expanded={picking} disabled={!canBecome.length}
              onClick={() => setPicking(v => !v)}
              title={canBecome.length ? 'Change what kind of property this is' : 'This kind of property cannot become another kind'}>
              <FieldIcon type={type} size={14} />
              <span style={sx('flex:1;min-width:0;text-align:left')}>{chosen.label}</span>
              {canBecome.length ? <span style={{ ...mono('font-size:8px'), color: 'var(--fg-faint)' }}>▾</span> : null}
            </button>
            {picking ? (
              <TypePicker inline value={type} kinds={kinds} onDismiss={() => setPicking(false)}
                onPick={t => { setType(t); setPicking(false); if (CHOICE_TYPES.includes(t) && !rows.length) setRows(toRows(field.options)); }} />
            ) : null}
            {type !== field.type ? <span className="pmNote">Existing values are kept as they are.</span> : null}
            {fixed ? <span className="pmNote">{field.primary ? 'This is the name of every record, so only its label can change.' : 'This is the stage the promotion rule guards, so only its label can change.'}</span> : null}
          </div>

          {hasChoices && !fixed ? (
            <div className="pmField">
              <span className="pmLabel">Choices</span>
              <Choices rows={rows} onChange={setRows} open={type === 'multiselect'} />
            </div>
          ) : null}

          {type === 'text' && !fixed ? (
            <Toggle on={multiline} onChange={setMultiline} label="Long text" hint="Several lines: a prompt, a note, a description." />
          ) : null}
          {type === 'file' ? (
            <Toggle on={lead} onChange={setLead} label="Lead picture" hint="The picture that leads this collection's cards and rows." />
          ) : null}

          {error ? <span className="pmError" role="alert">{error}</span> : null}

          <div className="pmActions">
            <Btn variant="primary" size="sm" style={sx('font-size:var(--t-data)')} onClick={save} busy={busy} disabled={!dirty}>{busy ? 'Saving…' : 'Save'}</Btn>
            <Btn variant="ghost" size="sm" style={sx('font-size:var(--t-data)')} onClick={onClose}>Cancel</Btn>
          </div>

          {canHide || canDelete ? <MenuDivider /> : null}
          {canHide ? <MenuRow label="Hide in this view" hint="Still on every record; just not shown here." onClick={hide} disabled={busy} /> : null}
          {canDelete ? <MenuRow danger label="Delete property…" onClick={() => { setError(null); setConfirming(true); }} disabled={busy} /> : null}
        </>
      )}

      {confirming && error ? <span className="pmError" role="alert">{error}</span> : null}
    </div>
  );
}

// ── add ──────────────────────────────────────────────────────────────────────────────────────
// `AddField` creates the property. A view shows the properties it NAMES, so one made from a view
// is also switched on there — otherwise "add a column" would add nothing anyone could see.
export function AddProperty({ collection, view, onSaveView, onSchemaChanged, onClose, actor }) {
  const done = async field => {
    try {
      // Schema first, so the view is written against a collection that already has the field.
      if (onSchemaChanged) await onSchemaChanged();
      if (onSaveView && view) await onSaveView({ ...view, fields: [...shownKeys(collection, view).filter(k => k !== field.key), field.key], card: null });
    } finally { onClose && onClose(); }
  };
  return (
    <div className="pmForm">
      <div className="pmHead"><span className="pmTitle">New property</span></div>
      <AddField variant="popover" collection={collection} actor={actor} onCancel={onClose} onDone={done} />
    </div>
  );
}
