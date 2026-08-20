// The view bar — the strip above every collection: which view, what shape, how tight, and the
// door to a new one.
//
// This is Tesseract's `TableToolbar.svelte` + `SaveViewModal.svelte` (docs/06_REUSE.md), reduced
// to what Scout's backend already answers. That reduction is the point of this file: `views.mjs`
// has shipped `type` (table · board · list · gallery), `filter` with nine operators, `sort`,
// `group`, `fields` and `density` since M1, and `PUT /api/views/:collection` writes them into the
// vault so a view travels with the data. **None of it had a control.** A person could not switch a
// collection to a board, could not tighten the rows, and could not make a filtered sub-view — not
// because the app could not, but because nothing on screen said so.
//
// `density` is the one field here that had no reader at all. It has been in `defaultView()` since
// the beginning; this is the first thing that renders it.
//
// PROPS — the dispatcher (CollectionView) mounts this; nothing here reaches into App.jsx.
//   collection · view · views · counts      what is on screen
//   density      'compact' | 'cosy' | 'roomy' — the row scale, resolved by the caller
//   onPickView(id)          switch to a saved view
//   onDensity(d)            change the row scale
//   onSaveView(view)        write a view (create or update). One route, one writer.
//   onDeleteView(id)        remove one. A generated view has nothing to delete.

import React from 'react';
import { sx } from './sx';
import { MONO } from './tokens';
import { Btn, Input } from './ui';
import { FieldIcon } from './cells';

const mono = (extra = '') => ({ ...sx(extra), fontFamily: MONO });

// ── row density ────────────────────────────────────────────────────────────────────────────────
// Three steps, not a slider: a table is read at a handful of scales and a continuous control makes
// a person tune something they wanted to pick. The numbers are the row's vertical padding and its
// type size; the same scale drives the list and the board card so the whole collection tightens
// together rather than the table alone.
export const DENSITIES = ['compact', 'cosy', 'roomy'];
export const DENSITY = {
  compact: { pad: '5px 14px', font: 12, line: 1.25, gap: 6, chip: 0.92, label: 'Compact' },
  cosy: { pad: '9px 14px', font: 12.5, line: 1.35, gap: 8, chip: 1, label: 'Cosy' },
  roomy: { pad: '14px 14px', font: 13.5, line: 1.5, gap: 10, chip: 1.06, label: 'Roomy' },
};
export const densityOf = view => DENSITY[view?.density] || DENSITY.cosy;

// The four shapes a collection can take. `board` is the Kanban one — it is called `board`
// everywhere in the backend and in docs/02_DATA_MODEL.md, so it is called `board` here too and the
// hint carries the word people actually search for.
const SHAPES = [
  { type: 'table', label: 'Table', icon: 'json', hint: 'Rows and columns.' },
  { type: 'board', label: 'Board', icon: 'status', hint: 'Kanban — one column per stage, drag to promote.' },
  { type: 'list', label: 'List', icon: 'text', hint: 'One line per record, grouped by day.' },
  { type: 'gallery', label: 'Gallery', icon: 'file', hint: 'Tiles, led by the primary image.' },
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

// A small anchored menu. Three controls on this bar need one and Scout has no popover primitive;
// this is that primitive, kept local until a fourth caller earns it a place in ui.jsx.
function Menu({ open, onDismiss, width = 200, align = 'left', children }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); onDismiss(); } };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open, onDismiss]);
  if (!open) return null;
  return (
    <div ref={ref}
      style={{
        ...sx('position:absolute;top:100%;z-index:40;margin-top:5px;padding:5px;border-radius:9px;display:flex;flex-direction:column;gap:1px'),
        [align]: 0, width,
        background: 'var(--surface-2)', border: '1px solid var(--border-3)', boxShadow: '0 12px 28px rgba(0,0,0,.4)',
      }}>
      {children}
    </div>
  );
}

function MenuRow({ on, onClick, icon, label, hint, danger }) {
  return (
    <button type="button" onClick={onClick} className="hBg"
      style={{
        ...sx('display:flex;align-items:center;gap:9px;min-height:26px;padding:4px 7px;border-radius:5px;cursor:pointer;text-align:left;background:none;border:none;width:100%;transition:background 130ms ease'),
        color: danger ? 'var(--danger)' : on ? 'var(--fg)' : 'var(--fg-muted)',
      }}>
      {icon ? <FieldIcon type={icon} size={14} /> : null}
      <span style={sx('flex:1;min-width:0;display:flex;flex-direction:column;gap:1px')}>
        <span style={{ ...sx('font-size:11.5px;font-weight:' + (on ? 600 : 500)) }}>{label}</span>
        {hint ? <span style={{ ...sx('font-size:10px;line-height:1.35'), color: 'var(--fg-faint)' }}>{hint}</span> : null}
      </span>
      {on ? <span style={{ ...mono('font-size:9px'), color: 'var(--accent)' }}>✓</span> : null}
    </button>
  );
}

const barBtn = active => ({
  ...sx('display:flex;align-items:center;gap:6px;height:26px;padding:0 9px;border-radius:6px;font-size:11px;cursor:pointer;transition:background 130ms ease,border-color 130ms ease'),
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
      group: type === 'board' ? (base.group || (gate && gate.key) || null) : null,
      fields: (existing || base).fields || [],
      density: (existing || base).density || 'cosy',
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

export default function ViewBar({
  collection, view, views, counts, onPickView, onSaveView, onDeleteView,
}) {
  const [shaping, setShaping] = React.useState(false);
  const [tuning, setTuning] = React.useState(false);
  const [composing, setComposing] = React.useState(null);   // null | 'new' | 'edit'
  const d = densityOf(view);

  const shape = SHAPES.find(s => s.type === view.type) || SHAPES[0];
  const gate = (collection.fields || []).find(f => f.gate) || (collection.fields || []).find(f => f.type === 'status');

  // Changing the shape or the density SAVES the view. A view lives in the vault (Law 1), so a
  // person who turns a collection into a board should find it a board tomorrow — and on the other
  // machine. It is not a session preference, and storing it as one is how two people end up
  // looking at the same collection and describing different screens to each other.
  const setShape = type => { setShaping(false); onSaveView({ ...view, type, group: type === 'board' ? (view.group || (gate && gate.key) || null) : null }); };
  const setDensity = density => { setTuning(false); onSaveView({ ...view, density }); };

  return (
    <div style={sx('flex:none;display:flex;flex-direction:column')}>
      <div style={sx('display:flex;align-items:flex-start;gap:10px;padding:10px 20px 0')}>
        {/* Left: the saved views, which may wrap. Right: the controls, which must not — a shape
            picker that jumps to a second line when someone adds a fifth view is a control that
            moves while you are reaching for it. */}
        <div style={sx('flex:1;min-width:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap')}>
        {(views || []).map(v => {
          const on = v.id === view.id;
          return (
            <button key={v.id} onClick={() => onPickView(v.id)}
              style={{
                ...sx('display:flex;align-items:center;gap:8px;height:26px;padding:0 11px;border-radius:6px;font-size:11.5px;cursor:pointer;transition:background 130ms ease,color 130ms ease'),
                background: on ? 'var(--raise)' : 'transparent',
                border: '1px solid ' + (on ? 'var(--border-3)' : 'transparent'),
                color: on ? 'var(--fg)' : 'var(--fg-muted)',
                fontWeight: on ? 600 : 500,
              }}>
              <span>{v.label || v.id}</span>
              {counts && counts[v.id] != null ? (
                <span style={{ ...mono('font-size:10px;font-weight:600;font-variant-numeric:tabular-nums'), color: on ? 'var(--fg-soft)' : 'var(--fg-faint)' }}>
                  {counts[v.id]}
                </span>
              ) : null}
            </button>
          );
        })}

        <button type="button" onClick={() => setComposing(composing === 'new' ? null : 'new')}
          title="A saved view is a filter with a name. It is written into the vault beside the records."
          style={{ ...sx('display:flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:6px;font-size:11.5px;cursor:pointer;background:none;border:1px solid transparent'), color: 'var(--fg-faint)' }}
          className="hFgL">
          <span style={sx('font-size:12px;line-height:1')}>+</span><span>New view</span>
        </button>

        </div>

        <div style={sx('flex:none;display:flex;align-items:center;gap:6px')}>
        {/* shape */}
        <div style={sx('position:relative')}>
          <button type="button" onClick={() => { setShaping(v => !v); setTuning(false); }} style={barBtn(shaping)} title="How this collection is laid out">
            <FieldIcon type={shape.icon} size={13} />
            <span>{shape.label}</span>
            <span style={{ ...mono('font-size:8px'), color: 'var(--fg-faint)' }}>▾</span>
          </button>
          <Menu open={shaping} onDismiss={() => setShaping(false)} width={252} align="right">
            {SHAPES.map(s => (
              <MenuRow key={s.type} on={s.type === view.type} icon={s.icon} label={s.label} hint={s.hint}
                onClick={() => setShape(s.type)} />
            ))}
          </Menu>
        </div>

        {/* density */}
        <div style={sx('position:relative')}>
          <button type="button" onClick={() => { setTuning(v => !v); setShaping(false); }} style={barBtn(tuning)} title="Row height">
            <span style={sx('display:flex;flex-direction:column;gap:2px;width:12px')} aria-hidden="true">
              <span style={{ ...sx('height:1px;width:100%'), background: 'currentColor' }} />
              <span style={{ ...sx('height:1px;width:100%'), background: 'currentColor' }} />
              <span style={{ ...sx('height:1px;width:100%'), background: 'currentColor' }} />
            </span>
            <span>{d.label}</span>
            <span style={{ ...mono('font-size:8px'), color: 'var(--fg-faint)' }}>▾</span>
          </button>
          <Menu open={tuning} onDismiss={() => setTuning(false)} width={170} align="right">
            {DENSITIES.map(k => (
              <MenuRow key={k} on={(view.density || 'cosy') === k} label={DENSITY[k].label}
                onClick={() => setDensity(k)} />
            ))}
          </Menu>
        </div>

        {/* edit / delete this view */}
        <button type="button" onClick={() => setComposing(composing === 'edit' ? null : 'edit')}
          style={barBtn(composing === 'edit')} title="Edit this view's filters">Filters</button>
        {!view.generated && onDeleteView && (views || []).length > 1 ? (
          <button type="button" onClick={() => onDeleteView(view.id)} className="hFg"
            title="Delete this view. The records are untouched — a view is only a saved query."
            style={{ ...mono('height:26px;padding:0 8px;font-size:11px;background:none;border:1px solid transparent;border-radius:6px;cursor:pointer'), color: 'var(--fg-faint)' }}>✕</button>
        ) : null}
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
