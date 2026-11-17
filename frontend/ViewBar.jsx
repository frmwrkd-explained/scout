// The view bar — the two strips above every collection.
//
//   row 1   the saved views (tabs) · the layout switcher (table · list · board · cards) · + New
//   row 2   Filter · Sort · Group · Properties · Picture · the size scale · how many records
//
// Every control here edits ONE saved view and writes it through the one route
// (`PUT /api/views/:collection`), into `.scout/views/<collection>.json` — the same object an agent
// reads and writes. There is no second, session-local idea of "how I like this collection".
//
// Each control is its own small popover with one job, named for what it changes, instead of one
// settings sheet: a person looking for "which properties are on these cards" finds a button that
// says Properties. What the keys mean and what they default to lives in `./viewDisplay` — this
// file only draws the controls.
//
// PROPS — the dispatcher (CollectionView) mounts this; nothing here reaches into App.jsx.
//   collection · view · views · counts · total     what is on screen
//   onPickView(id)          switch to a saved view
//   onSaveView(view)        write a view (create or update). One route, one writer.
//   onDeleteView(id)        remove one. A generated view has nothing to delete.
//   onSchemaChanged()       the schema or the records changed under the screen — re-read them
//   onOpen({ path })        open a record's page
//   actor                   who is at the keyboard (never an agent)

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Btn, Input } from './ui';
import { FieldIcon } from './cells';
import { api } from './api';
// `Menu` / `MenuRow` (the anchored popover and its rows) moved to PropertyMenu.jsx when the table
// header needed them too. Imported from there; nothing else about them changed.
import { Menu, MenuRow, MenuDivider, PropertyEditor, AddProperty } from './PropertyMenu';
import {
  SIZES, SIZE, sizeKey, coverOf, fitOf, wrapOf, summaryOf, fileFieldsOf, pickableFields,
  groupableFields, groupFieldOf, fieldLabel,
} from './viewDisplay';
import { boardField, boardFields } from './BoardView';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// The four shapes a collection can take. `board` is the Kanban one — it is called `board`
// everywhere in the backend and in docs/02_DATA_MODEL.md, so it is called `board` here too and the
// hint carries the word people actually search for.
const SHAPES = [
  { type: 'table', label: 'Table', icon: 'json', hint: 'Rows and columns.' },
  { type: 'board', label: 'Board', icon: 'status', hint: 'One column per stage. Drag a card to move it.' },
  { type: 'list', label: 'List', icon: 'text', hint: 'One line per record, grouped by day.' },
  { type: 'gallery', label: 'Cards', icon: 'file', hint: 'Cards, led by the picture.' },
];

// The operators `backend/views.mjs OPS` actually implements. Naming a tenth here would build a
// filter the server drops on the floor, so this list is copied FROM that table and nowhere else.
const OPS = [
  { op: 'is', label: 'is' },
  { op: 'is-not', label: 'is not' },
  { op: 'contains', label: 'contains' },
  { op: 'gt', label: '>' },
  { op: 'lt', label: '<' },
  { op: 'gte', label: '≥' },
  { op: 'lte', label: '≤' },
  { op: 'empty', label: 'is empty' },
  { op: 'not-empty', label: 'is not empty' },
];
const NEEDS_VALUE = op => op !== 'empty' && op !== 'not-empty';

const slug = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const barBtn = active => ({
  ...sx('display:flex;align-items:center;gap:7px;height:30px;padding:0 11px;border-radius:7px;font-size:var(--t-small);font-weight:500;white-space:nowrap;cursor:pointer;transition:background 130ms ease,border-color 130ms ease'),
  background: active ? 'var(--raise)' : 'transparent',
  border: '1px solid ' + (active ? 'var(--border-3)' : 'var(--border)'),
  color: active ? 'var(--fg)' : 'var(--fg-muted)',
});

// ── the sub-view composer ──────────────────────────────────────────────────────────────────────
// "Create sub-views based on filters manually" — a name, a shape, and rows of
// `field · operator · value`. It writes a REAL saved view through the one route, so the view it
// makes is the same object an agent writes and it lands in `.scout/views/<collection>.json` where
// the data can carry it. There is no second kind of view.
function ViewComposer({ collection, base, existing, onCancel, onSave }) {
  const fields = collection.fields || [];
  const [label, setLabel] = React.useState(existing ? existing.label || existing.id : '');
  const [type, setType] = React.useState((existing || base).type || 'table');
  const [filter, setFilter] = React.useState(() => ((existing || base).filter || []).map(f => ({ ...f })));
  const [sort, setSort] = React.useState(() => ((existing || base).sort || []).map(s => ({ ...s })));
  const [error, setError] = React.useState(null);

  const gate = fields.find(f => f.gate) || fields.find(f => f.type === 'status');
  const optionsFor = key => {
    const f = fields.find(x => x.key === key);
    return (f?.options || []).map(o => (typeof o === 'string' ? o : o.value));
  };

  const addRow = () => setFilter(rows => [...rows, { field: (fields[0] || {}).key || 'name', op: 'is', value: '' }]);
  const setRow = (i, patch) => setFilter(rows => rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const dropRow = i => setFilter(rows => rows.filter((_, n) => n !== i));

  const save = () => {
    setError(null);
    const id = existing ? existing.id : slug(label);
    if (!id) return setError('Give the view a name.');
    if (!existing && (base.views || []).some(v => v.id === id)) return setError('There is already a view called "' + id + '".');
    onSave({
      id,
      label: label.trim() || id,
      type,
      // An `empty` / `not-empty` row carries no value, and sending one would be a value the
      // server's operator ignores — drop it rather than write a lie into the vault.
      filter: filter
        .filter(f => f.field && (NEEDS_VALUE(f.op) ? String(f.value ?? '') !== '' : true))
        .map(f => (NEEDS_VALUE(f.op) ? { field: f.field, op: f.op, value: f.value } : { field: f.field, op: f.op })),
      sort: sort.filter(s => s.field),
      group: type === 'board' ? ((existing || base).group || (gate && gate.key) || null) : ((existing || base).group || null),
      // How it LOOKS is carried over untouched: a new view starts out looking like the one it was
      // made from, and editing a view's filter must not reset its size or its properties.
      ...Object.fromEntries(['fields', 'size', 'density', 'cover', 'fit', 'summary', 'wrap', 'widths', 'card']
        .filter(k => (existing || base)[k] !== undefined).map(k => [k, (existing || base)[k]])),
    }).catch(e => setError(e.message));
  };

  const selectStyle = sx('height:24px;padding:0 6px;border-radius:5px;font-size:11px;background:var(--ink);border:1px solid var(--border-2);color:var(--fg-soft)');

  return (
    <div style={{
      ...sx('display:flex;flex-direction:column;gap:10px;margin:0 20px 10px;padding:12px;border-radius:9px'),
      background: 'var(--surface-2)', border: '1px solid var(--border-2)',
    }}>
      <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
        <span style={{ ...mono('font-size:8.5px;font-weight:700;letter-spacing:.16em;white-space:nowrap'), color: 'var(--fg-faint)' }}>
          {existing ? 'EDIT VIEW' : 'NEW VIEW'}
        </span>
        <Input value={label} autoFocus placeholder="What is this view for? — Manila, high scores, gone cold"
          onChange={e => setLabel(e.target.value)} disabled={!!existing && existing.generated}
          style={sx('flex:1;min-width:180px;height:26px;padding:0 10px;font-size:12px')} />
        {SHAPES.map(s => (
          <button key={s.type} type="button" onClick={() => setType(s.type)} title={s.hint}
            style={barBtn(type === s.type)}>
            <FieldIcon type={s.icon} size={13} />
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <div style={sx('display:flex;flex-direction:column;gap:6px')}>
        {filter.map((f, i) => (
          <div key={i} style={sx('display:flex;align-items:center;gap:6px;flex-wrap:wrap')}>
            <span style={{ ...mono('font-size:9px;font-weight:700;letter-spacing:.12em;width:28px'), color: 'var(--fg-faint)' }}>
              {i ? 'AND' : 'WHERE'}
            </span>
            <select value={f.field} onChange={e => setRow(i, { field: e.target.value, value: '' })} style={selectStyle}>
              {fields.map(x => <option key={x.key} value={x.key}>{x.label || x.key}</option>)}
            </select>
            <select value={f.op} onChange={e => setRow(i, { op: e.target.value })} style={selectStyle}>
              {OPS.map(o => <option key={o.op} value={o.op}>{o.label}</option>)}
            </select>
            {NEEDS_VALUE(f.op) ? (
              optionsFor(f.field).length ? (
                <select value={String(f.value ?? '')} onChange={e => setRow(i, { value: e.target.value })} style={selectStyle}>
                  <option value="">—</option>
                  {optionsFor(f.field).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <Input value={String(f.value ?? '')} onChange={e => setRow(i, { value: e.target.value })}
                  placeholder="value" style={sx('width:150px;height:24px;padding:0 8px;font-size:11px')} />
              )
            ) : null}
            <button type="button" onClick={() => dropRow(i)} className="hFg"
              style={{ ...mono('font-size:11px;background:none;border:none;cursor:pointer;padding:0 4px'), color: 'var(--fg-faint)' }}>✕</button>
          </div>
        ))}
        <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
          <Btn variant="ghost" size="sm" onClick={addRow}>+ Filter</Btn>
          <select value={sort[0]?.field || ''} style={selectStyle}
            onChange={e => setSort(e.target.value ? [{ field: e.target.value, dir: sort[0]?.dir || 'desc' }] : [])}>
            <option value="">no sort</option>
            {fields.map(x => <option key={x.key} value={x.key}>sort by {x.label || x.key}</option>)}
          </select>
          {sort[0] ? (
            <button type="button" onClick={() => setSort([{ ...sort[0], dir: sort[0].dir === 'desc' ? 'asc' : 'desc' }])}
              style={barBtn(false)}>{sort[0].dir === 'desc' ? '↓ high to low' : '↑ low to high'}</button>
          ) : null}
        </div>
      </div>

      <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
        <Btn variant="primary" size="sm" onClick={save}>{existing ? 'Save view' : 'Create view'}</Btn>
        <Btn variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <span style={{ ...sx('flex:1;min-width:0;font-size:11px'), color: error ? 'var(--danger)' : 'var(--fg-faint)' }}>
          {error || 'Saved into the vault at .scout/views/' + collection.id + '.json — it travels with the data, and an assistant can read it.'}
        </span>
      </div>
    </div>
  );
}


// ── small parts ──────────────────────────────────────────────────────────────────────────────

// A segmented control: a `--sunk` tray, the chosen segment raised (design/EXTRACT.md §3.4).
function Segmented({ options, value, onPick, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="vbSeg">
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} title={o.hint || o.label}
            onClick={() => onPick(o.value)} className={'vbSegBtn' + (on ? ' on' : '')}>
            {o.icon ? <FieldIcon type={o.icon} size={14} /> : null}
            {o.text != null ? <span>{o.text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={sx('display:flex;flex-direction:column;gap:2px;padding:4px 0')}>
      <span style={{ ...mono('font-size:var(--t-label);font-weight:700;letter-spacing:.12em;padding:4px 9px 3px'), color: 'var(--fg-faint)' }}>{title}</span>
      {children}
    </div>
  );
}

function Check({ on }) {
  return (
    <span aria-hidden="true" style={{
      ...sx('flex:none;width:16px;height:16px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1'),
      border: '1px solid ' + (on ? 'var(--fg-muted)' : 'var(--border-3)'),
      background: on ? 'var(--fg-soft)' : 'transparent', color: 'var(--ink)',
    }}>{on ? '✓' : ''}</span>
  );
}

// One popover button on row 2. `value` is what the control is currently set to, printed on the
// button itself so the bar reads as a sentence: Sort · Score ↓, Group · Category, Properties · 3.
function Control({ label, value, active, width = 260, align = 'left', children }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={sx('position:relative')}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} style={barBtn(open || active)}>
        <span>{label}</span>
        {value != null && value !== '' ? <span style={{ color: 'var(--fg-faint)' }}>·</span> : null}
        {value != null && value !== '' ? <span style={{ ...sx('font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis'), color: 'var(--fg)' }}>{value}</span> : null}
        <span style={{ ...mono('font-size:8px'), color: 'var(--fg-faint)' }}>▾</span>
      </button>
      <Menu open={open} onDismiss={() => setOpen(false)} width={width} align={align}>
        {typeof children === 'function' ? children(() => setOpen(false)) : children}
      </Menu>
    </div>
  );
}

// ── Properties ───────────────────────────────────────────────────────────────────────────────
// Which of the collection's fields this view shows, and in what order. The same list drives a
// table's columns, a list row's values and a card's lines — `view.fields`, one list, four layouts.
function Properties({ collection, view, onSave, onSchemaChanged, actor }) {
  // null · a field key (its editor is open) · 'new' (the add composer is open). The editor takes
  // the menu's place rather than floating beside it: this menu scrolls, and a second floating
  // layer inside a scrolling one is clipped by it.
  const [editing, setEditing] = React.useState(null);
  const { shown, hidden } = pickableFields(collection, view);
  const write = keys => onSave({ ...view, fields: keys, card: null });
  const keys = shown.map(f => f.key);
  const move = (key, by) => {
    const at = keys.indexOf(key), to = at + by;
    if (to < 0 || to >= keys.length) return;
    const next = [...keys]; next.splice(at, 1); next.splice(to, 0, key);
    write(next);
  };

  if (editing === 'new') {
    return <AddProperty collection={collection} view={view} onSaveView={onSave} onSchemaChanged={onSchemaChanged} actor={actor} onClose={() => setEditing(null)} />;
  }
  const target = editing ? (collection.fields || []).find(f => f.key === editing) : null;
  if (target) {
    return (
      <PropertyEditor collection={collection} field={target} view={view} onSaveView={onSave} onSchemaChanged={onSchemaChanged}
        actor={actor} onClose={() => setEditing(null)} onBack={() => setEditing(null)} />
    );
  }

  const row = (f, on) => (
    <div key={f.key} className="vbProp">
      <button type="button" className="vbPropMain hBg" role="checkbox" aria-checked={on}
        onClick={() => write(on ? keys.filter(k => k !== f.key) : [...keys, f.key])}>
        <Check on={on} />
        <FieldIcon type={f.type} size={14} style={{ color: 'var(--fg-faint)' }} />
        <span style={{ ...sx('flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--t-small)'), color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{fieldLabel(f)}</span>
      </button>
      {on ? (
        <span className="vbPropMove">
          <button type="button" title="Move up" aria-label={'Move ' + fieldLabel(f) + ' up'} disabled={keys.indexOf(f.key) === 0} onClick={() => move(f.key, -1)}>↑</button>
          <button type="button" title="Move down" aria-label={'Move ' + fieldLabel(f) + ' down'} disabled={keys.indexOf(f.key) === keys.length - 1} onClick={() => move(f.key, 1)}>↓</button>
        </span>
      ) : null}
      {/* Rename, re-type, choices, delete — the same editor the table's column header opens. Only
          for a field the schema declares: an undeclared key has nothing to edit yet. */}
      {onSchemaChanged && (collection.fields || []).some(x => x.key === f.key) ? (
        <button type="button" className="vbPropEdit" title={'Edit ' + fieldLabel(f)} aria-label={'Edit the property ' + fieldLabel(f)} onClick={() => setEditing(f.key)}>⋯</button>
      ) : null}
    </div>
  );
  const flag = (key, on, label, hint) => (
    <button type="button" className="vbPropMain hBg" role="checkbox" aria-checked={on} onClick={() => onSave({ ...view, [key]: !on })}>
      <Check on={on} />
      <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;text-align:left')}>
        <span style={{ ...sx('font-size:var(--t-small)'), color: on ? 'var(--fg)' : 'var(--fg-muted)' }}>{label}</span>
        <span style={{ ...sx('font-size:var(--t-data);line-height:1.35'), color: 'var(--fg-faint)' }}>{hint}</span>
      </span>
    </button>
  );
  return (
    <>
      <Section title={'SHOWN · ' + shown.length}>
        {shown.length ? shown.map(f => row(f, true)) : (
          <span style={{ ...sx('font-size:var(--t-data);padding:4px 9px 6px'), color: 'var(--fg-faint)' }}>Only the name. Tick a property below to add it.</span>
        )}
      </Section>
      {hidden.length ? <Section title="HIDDEN">{hidden.map(f => row(f, false))}</Section> : null}
      {onSchemaChanged ? (
        <>
          <MenuDivider />
          <button type="button" className="vbPropNew hBg" onClick={() => setEditing('new')}>
            <span style={sx('width:16px;text-align:center;font-size:15px;line-height:1')}>+</span><span>New property</span>
          </button>
          <MenuDivider />
        </>
      ) : null}
      <Section title="ALSO">
        {view.type !== 'table' ? flag('summary', summaryOf(view), 'First paragraph', 'The opening lines of the note, under the name.') : null}
        {view.type === 'table' || view.type === 'list' ? flag('wrap', wrapOf(view), 'Wrap long values', 'Let a value take several lines instead of being cut off.') : null}
      </Section>
    </>
  );
}

// ── + New ────────────────────────────────────────────────────────────────────────────────────
// A record is created by NAME: one input, Enter. It goes through the one writer
// (`POST /api/records/upsert` → records.mjs), so it is deduped and logged like any other write —
// which also means a name the collection already has does not make a second file: the existing
// record is opened, and the popover says so first.
//
// A record made from a filtered view should land IN that view. Where the view says `status is
// shortlist` or `tags contains video`, the new record starts with that value.
function NewRecord({ collection, view, actor, onSchemaChanged, onOpen }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState(null);
  const [error, setError] = React.useState(null);
  const fields = collection.fields || [];
  const primary = fields.find(f => f.primary) || { key: 'name' };
  const thing = String(collection.label || collection.id || 'record');

  const close = () => { setOpen(false); setName(''); setNote(null); setError(null); };

  const prefill = () => {
    const out = {};
    for (const f of view.filter || []) {
      const def = fields.find(x => x.key === f.field);
      if (!def || f.value === undefined || f.value === '') continue;
      if (f.op === 'is' && (def.type === 'select' || def.type === 'status')) out[f.field] = f.value;
      if (f.op === 'contains' && def.type === 'multiselect') out[f.field] = [f.value];
    }
    return out;
  };

  const create = async () => {
    const title = name.trim();
    if (!title) return setError('Give it a name first.');
    setBusy(true); setError(null);
    try {
      const result = await api.upsert({ collection: collection.id, ...prefill(), [primary.key]: title, actor });
      if (onSchemaChanged) await onSchemaChanged();
      if (result.verdict === 'store') { close(); if (onOpen) onOpen({ path: result.path }); return; }
      // update · merge · skip: the pipeline recognised an existing record and did not make a new one.
      setNote('That matched a record already here' + (result.matched ? ' (' + result.matched + ')' : '') + ' — opening it instead of making a second one.');
      setTimeout(() => { close(); if (onOpen) onOpen({ path: result.path }); }, 1400);
    } catch (e) { setError(e.message || String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div style={sx('position:relative')}>
      <button type="button" className="vbNew hBdAccent" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}
        title={'Add a record to ' + thing}>
        <span style={sx('font-size:15px;line-height:1')}>+</span><span>New</span>
      </button>
      <Menu open={open} onDismiss={close} width={280} align="right">
        <div className="vbNewForm">
          <span style={sx('font-size:var(--t-small);font-weight:600;color:var(--fg)')}>New in {thing}</span>
          <Input value={name} autoFocus placeholder={fieldLabel(primary)} onChange={e => setName(e.target.value)} disabled={busy || !!note}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
            style={sx('height:30px;padding:0 10px;font-size:var(--t-small)')} />
          {note ? <span style={sx('font-size:var(--t-data);line-height:1.45;color:var(--fg-muted)')} role="status">{note}</span> : null}
          {error ? <span style={sx('font-size:var(--t-data);line-height:1.45;color:var(--danger)')} role="alert">{error}</span> : null}
          {!note ? (
            <div style={sx('display:flex;align-items:center;gap:8px')}>
              <Btn variant="primary" size="sm" style={sx('font-size:var(--t-data)')} onClick={create} busy={busy}>{busy ? 'Creating…' : 'Create'}</Btn>
              <Btn variant="ghost" size="sm" style={sx('font-size:var(--t-data)')} onClick={close}>Cancel</Btn>
            </div>
          ) : null}
        </div>
      </Menu>
    </div>
  );
}

export default function ViewBar({
  collection, view, views, counts, total, onPickView, onSaveView, onDeleteView,
  onSchemaChanged, onOpen, actor,
}) {
  const [composing, setComposing] = React.useState(null);   // null | 'new' | 'edit'
  const fields = collection.fields || [];
  const gate = fields.find(f => f.gate) || fields.find(f => f.type === 'status');
  const save = next => Promise.resolve(onSaveView(next)).catch(() => {});

  // Changing how a view looks SAVES it. A view lives in the vault (Law 1), so a collection someone
  // turned into cards is still cards tomorrow, and on the other machine.
  const setShape = type => save({ ...view, type, group: type === 'board' ? (view.group || (gate && gate.key) || null) : view.group || null });

  const sort = (view.sort || [])[0] || null;
  const sortField = sort ? fields.find(f => f.key === sort.field) || { key: sort.field } : null;
  const groupField = groupFieldOf(collection, view);
  const boardColumns = view.type === 'board' ? boardField(collection, view) : null;
  const files = fileFieldsOf(collection);
  const cover = coverOf(collection, view);
  const shownCount = pickableFields(collection, view).shown.length;
  const filters = (view.filter || []).length;
  const shown = (counts && counts[view.id] != null) ? counts[view.id] : total;

  return (
    <div className="vb">
      <div className="vbRow">
        {/* Left: the saved views, which may wrap. Right: the layout switcher, which must not — a
            control that jumps to a second line when someone adds a fifth view is a control that
            moves while you are reaching for it. */}
        <div className="vbTabs">
          {(views || []).map(v => {
            const on = v.id === view.id;
            return (
              <button key={v.id} type="button" onClick={() => onPickView(v.id)} className={'vbTab' + (on ? ' on' : '')}>
                <span>{v.label || v.id}</span>
                {counts && counts[v.id] != null ? (
                  <span className="vbTabCount" style={{ fontFamily: MONO }}>{Number(counts[v.id]).toLocaleString('en-US')}</span>
                ) : null}
              </button>
            );
          })}
          <button type="button" onClick={() => setComposing(composing === 'new' ? null : 'new')} className="vbTab vbTabNew hFgL"
            title="A saved view is a filter with a name. It is written into the workspace beside the records.">
            <span style={sx('font-size:15px;line-height:1')}>+</span><span>New view</span>
          </button>
        </div>

        <div className="vbRight">
          <Segmented label="Layout" value={view.type}
            options={SHAPES.map(s => ({ value: s.type, icon: s.icon, text: s.label, hint: s.hint }))}
            onPick={setShape} />
          <NewRecord collection={collection} view={view} actor={actor} onSchemaChanged={onSchemaChanged} onOpen={onOpen} />
        </div>
      </div>

      <div className="vbRow vbTools">
        <div style={sx('flex:1;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap')}>
          <button type="button" onClick={() => setComposing(composing === 'edit' ? null : 'edit')} style={barBtn(composing === 'edit' || filters > 0)}
            title="Which records this view holds">
            <span>Filter</span>
            {filters ? <span style={{ ...sx('font-weight:600'), color: 'var(--fg)' }}>· {filters}</span> : null}
          </button>

          <Control label="Sort" value={sortField ? fieldLabel(sortField) + (sort.dir === 'desc' ? ' ↓' : ' ↑') : null} active={!!sort} width={250}>
            {close => (
              <>
                {sort ? (
                  <Section title="DIRECTION">
                    <MenuRow on={sort.dir !== 'desc'} label="Ascending" hint="A to Z, low to high, oldest first" onClick={() => save({ ...view, sort: [{ field: sort.field, dir: 'asc' }] })} />
                    <MenuRow on={sort.dir === 'desc'} label="Descending" hint="Z to A, high to low, newest first" onClick={() => save({ ...view, sort: [{ field: sort.field, dir: 'desc' }] })} />
                  </Section>
                ) : null}
                <Section title="SORT BY">
                  <MenuRow on={!sort} label="No sort" onClick={() => { close(); save({ ...view, sort: [] }); }} />
                  {fields.map(f => (
                    <MenuRow key={f.key} on={sort && sort.field === f.key} icon={f.type} label={fieldLabel(f)}
                      onClick={() => save({ ...view, sort: [{ field: f.key, dir: (sort && sort.dir) || 'asc' }] })} />
                  ))}
                </Section>
              </>
            )}
          </Control>

          {view.type === 'board' ? (
            // The board's columns ARE a field's choices. Any single-choice field will do — Stage,
            // Tier, Industry, Owner — and dragging a card between columns sets that field.
            <Control label="Columns" value={boardColumns ? fieldLabel(boardColumns) : null} active={!!boardColumns} width={250}>
              {close => (
                <Section title="ONE COLUMN PER">
                  {boardFields(collection).map(f => (
                    <MenuRow key={f.key} on={boardColumns && boardColumns.key === f.key} icon={f.type} label={fieldLabel(f)}
                      hint={(f.options || []).length + ' choices'}
                      onClick={() => { close(); save({ ...view, group: f.key }); }} />
                  ))}
                  {!boardFields(collection).length ? <span className="vbEmpty">A board needs a property with choices (a stage, a tier). Add one from Properties.</span> : null}
                </Section>
              )}
            </Control>
          ) : null}

          {view.type !== 'board' ? (
            <Control label="Group" value={groupField ? fieldLabel(groupField) : null} active={!!groupField} width={230}>
              {close => (
                <Section title="GROUP BY">
                  <MenuRow on={!groupField} label="No grouping" onClick={() => { close(); save({ ...view, group: null }); }} />
                  {groupableFields(collection).map(f => (
                    <MenuRow key={f.key} on={groupField && groupField.key === f.key} icon={f.type} label={fieldLabel(f)}
                      onClick={() => { close(); save({ ...view, group: f.key }); }} />
                  ))}
                </Section>
              )}
            </Control>
          ) : null}

          <Control label="Properties" value={String(shownCount)} width={300}>
            <Properties collection={collection} view={view} onSave={save} onSchemaChanged={onSchemaChanged} actor={actor} />
          </Control>

          {files.length && view.type !== 'table' ? (
            <Control label="Picture" value={cover ? fieldLabel(cover) : 'None'} width={250}>
              <Section title="PICTURE">
                {files.map(f => (
                  <MenuRow key={f.key} on={cover && cover.key === f.key} icon="file" label={fieldLabel(f)} onClick={() => save({ ...view, cover: f.key })} />
                ))}
                <MenuRow on={!cover} label="No picture" onClick={() => save({ ...view, cover: false })} />
              </Section>
              {cover ? (
                <Section title="FIT">
                  <MenuRow on={fitOf(view) === 'contain'} label="Whole picture" hint="Nothing is cut off." onClick={() => save({ ...view, fit: 'contain' })} />
                  <MenuRow on={fitOf(view) === 'cover'} label="Fill the frame" hint="Every frame is full; edges may be cropped." onClick={() => save({ ...view, fit: 'cover' })} />
                </Section>
              ) : null}
            </Control>
          ) : null}

          {!view.generated && onDeleteView && (views || []).length > 1 ? (
            <button type="button" onClick={() => onDeleteView(view.id)} className="hFg"
              title="Delete this view. The records are untouched — a view is only a saved query."
              style={{ ...sx('height:30px;padding:0 9px;font-size:var(--t-small);background:none;border:1px solid transparent;border-radius:7px;cursor:pointer'), color: 'var(--fg-faint)' }}>Delete view</button>
          ) : null}
        </div>

        <div style={sx('flex:none;display:flex;align-items:center;gap:12px')}>
          <span className="vbCount" style={{ fontFamily: MONO }} title={(collection.query && collection.query.path) || ''}>
            {shown != null ? Number(shown).toLocaleString('en-US') + (Number(shown) === 1 ? ' record' : ' records') : ''}
          </span>
          <Segmented label="Size" value={sizeKey(view)}
            options={SIZES.map(k => ({ value: k, text: SIZE[k].short, hint: SIZE[k].label }))}
            onPick={size => save({ ...view, size })} />
        </div>
      </div>

      {composing ? (
        <div style={sx('padding-top:10px')}>
          <ViewComposer
            collection={collection}
            base={{ ...view, views }}
            existing={composing === 'edit' ? view : null}
            onCancel={() => setComposing(null)}
            onSave={v => Promise.resolve(onSaveView(v)).then(() => setComposing(null))}
          />
        </div>
      ) : null}
    </div>
  );
}
